FROM node:20.19.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3001 3002

CMD ["node", "dist/main.js"]
