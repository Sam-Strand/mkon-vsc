import * as vscode from 'vscode'
import mkon from 'mkon'

const output = vscode.window.createOutputChannel(
    'mkon vsc',
    { log: true }
)
let formatOptions = {}

function getOptions() {
    const config = vscode.workspace.getConfiguration('mkon-vsc')

    formatOptions = {
        condense: config.get('condense'),
        bracesSameLine: config.get('bracesSameLine'),
        emitRootBraces: config.get('emitRootBraces'),
        quotes: config.get('quotes'),
        multiline: config.get('multiline'),
        separator: config.get('separator'),
        space: config.get('space'),
        eol: config.get('eol'),
        colors: config.get('colors'),
        serializeDeterministically: config.get('serializeDeterministically'),
        quoteChar: config.get('quoteChar')
    }

    output.info('getOptions: ' + JSON.stringify(formatOptions))
}

vscode.workspace.onDidChangeConfiguration(getOptions)

getOptions()

function addBracketFoldRanges(document, ranges) {
    const stack = []

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex).text
        let i = 0

        while (i < line.length) {
            const ch = line[i]
            const next = line[i + 1]

            if (ch === '/' && next === '/') {
                break
            }

            if (ch === '/' && next === '*') {
                let j = i + 2
                while (j < line.length) {
                    if (line[j] === '*' && line[j + 1] === '/') {
                        break
                    }
                    j++
                }
                i = j + 2
                continue
            }

            if (ch === "'" || ch === '"') {
                const quote = ch
                i++
                while (i < line.length) {
                    if (line[i] === '\\') {
                        i += 2
                        continue
                    }
                    if (line[i] === quote) {
                        break
                    }
                    i++
                }
                i++
                continue
            }

            if (ch === '{' || ch === '[') {
                stack.push({ line: lineIndex, ch })
            } else if (ch === '}' || ch === ']') {
                const openChar = ch === '}' ? '{' : '['
                const last = stack[stack.length - 1]

                if (last && last.ch === openChar) {
                    ranges.push(
                        new vscode.FoldingRange(
                            last.line,
                            lineIndex,
                            vscode.FoldingRangeKind.Region
                        )
                    )
                    stack.pop()
                }
            }

            i++
        }
    }
}

function addTripleQuoteFoldRanges(document, ranges) {
    let blockStart = null

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text

        if (blockStart !== null) {
            if (line.includes("'''")) {
                ranges.push(
                    new vscode.FoldingRange(
                        blockStart,
                        i,
                        vscode.FoldingRangeKind.Region
                    )
                )
                blockStart = null
            }
            continue
        }

        const idx = line.indexOf("'''")
        if (idx !== -1) {
            // если на этой же строке есть ещё один ''' — это открытие и закрытие сразу
            const nextIdx = line.indexOf("'''", idx + 3)
            if (nextIdx === -1) {
                blockStart = i
            }
        }
    }
}

function addBlockCommentFoldRanges(document, ranges) {
    let blockStart = null

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text

        if (blockStart !== null) {
            if (line.includes('*/')) {
                ranges.push(
                    new vscode.FoldingRange(
                        blockStart,
                        i,
                        vscode.FoldingRangeKind.Comment
                    )
                )
                blockStart = null
            }
            continue
        }

        if (/^\s*\/\*/.test(line)) {
            blockStart = i
        }
    }
}

const diagnostics = vscode.languages.createDiagnosticCollection('mkon')
const validateTimers = new Map()

// диапазон для подсветки: токен в месте ошибки, а если там пробел или конец файла — фрагмент перед ним
function errorRange(document, e) {
    const text = document.getText()
    const isSpace = c => /\s/.test(c)
    const isStop = c => isSpace(c) || '{}[],:'.includes(c)
    let start = Math.min(e.offset, text.length)

    if (start >= text.length || isSpace(text[start])) {
        let end = start
        while (end > 0 && isSpace(text[end - 1])) end--
        if (end === 0) {
            return new vscode.Range(document.positionAt(0), document.positionAt(Math.min(1, text.length)))
        }
        start = end - 1
        if (!isStop(text[start])) {
            // весь фрагмент строки до разделителя, а не только последнее слово
            while (start > 0 && text[start - 1] !== '\n' && !'{}[],:'.includes(text[start - 1])) start--
            while (isSpace(text[start])) start++
        }
        return new vscode.Range(document.positionAt(start), document.positionAt(end))
    }

    let end = start + 1
    if (!isStop(text[start])) {
        while (end < text.length && !isStop(text[end])) end++
    }
    return new vscode.Range(document.positionAt(start), document.positionAt(end))
}

function toDiagnostic(document, e) {
    const range = typeof e.offset === 'number'
        ? errorRange(document, e)
        : document.lineAt(0).range
    let message = e.reason || e.message
    if (e.hint) message += '\n' + e.hint
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error)
    diagnostic.source = 'mkon'
    return diagnostic
}

function validate(document) {
    if (document.languageId !== 'mkon') return
    // errors включает режим восстановления: парсер читает дальше и собирает все ошибки
    const errors = []
    try {
        mkon.rt.parse(document.getText(), { errors })
    } catch (e) {
        errors.push(e)
    }
    diagnostics.set(document.uri, errors.map(e => toDiagnostic(document, e)))
}

function scheduleValidate(document) {
    const key = document.uri.toString()
    clearTimeout(validateTimers.get(key))
    validateTimers.set(key, setTimeout(() => {
        validateTimers.delete(key)
        validate(document)
    }, 300))
}

export function activate(context) {
    output.info('activate')

    const format = (
        document,
        options
    ) => {
        // set default eol by current document
        const documentEol = document.eol === vscode.EndOfLine.LF ? '\n' : '\r\n'
        formatOptions.eol =
            !formatOptions.eol || formatOptions.eol === 'auto'
                ? documentEol
                : formatOptions.eol

        // set indents size
        formatOptions.space =
            !formatOptions.space || formatOptions.space === 'auto'
                ? options.tabSize
                : formatOptions.space

        const result = []

        const start = new vscode.Position(0, 0)
        const end = new vscode.Position(
            document.lineCount - 1,
            document.lineAt(document.lineCount - 1).text.length
        )
        const range = new vscode.Range(start, end)
        const s = document.getText(range)
        try {
            mkon.setEndOfLine(formatOptions.eol)
            const parsed = mkon.rt.parse(s)
            const formattedText = mkon.rt.stringify(parsed, formatOptions)
            result.push(new vscode.TextEdit(range, formattedText))
            return result
        } catch (e) {
            const diagnostic = toDiagnostic(document, e)
            diagnostics.set(document.uri, [diagnostic])
            const pos = diagnostic.range.start
            vscode.window.showErrorMessage(
                `mkon: ${e.reason || e.message} (строка ${pos.line + 1}, столбец ${pos.character + 1})`,
                'Показать'
            ).then(choice => {
                if (choice !== 'Показать') return
                vscode.window.showTextDocument(document, { selection: diagnostic.range })
            })
            output.error(e.message)
        }
    }
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('mkon', {
            provideDocumentFormattingEdits(document, options, token) {
                return format(document, options)
            }
        })
    )

    context.subscriptions.push(
        diagnostics,
        vscode.workspace.onDidOpenTextDocument(validate),
        vscode.workspace.onDidChangeTextDocument(event => scheduleValidate(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => {
            clearTimeout(validateTimers.get(document.uri.toString()))
            diagnostics.delete(document.uri)
        })
    )
    vscode.workspace.textDocuments.forEach(validate)

    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider('mkon', {
            provideFoldingRanges(document, context, token) {
                const ranges = []
                addBracketFoldRanges(document, ranges)
                addTripleQuoteFoldRanges(document, ranges)
                addBlockCommentFoldRanges(document, ranges)
                return ranges
            }
        })
    )
}

export function deactivate() { }
