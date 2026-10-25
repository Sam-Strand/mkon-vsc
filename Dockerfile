FROM node:26-alpine

RUN apk add --no-cache git bash make

WORKDIR /ext

# vsce для упаковки в .vsix
RUN npm install -g pnpm @vscode/vsce

CMD ["sh"]