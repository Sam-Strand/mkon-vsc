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
            vscode.window.showErrorMessage(
                'Formatted document failed, please check your syntax'
            )
            console.error(e)
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
