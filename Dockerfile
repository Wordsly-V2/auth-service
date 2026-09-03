FROM node:20.19.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3001

# The build emits dist/src/main.js (tsconfig rootDir includes src), not
# dist/main.js -- the old CMD pointed at a path that never existed, so the
# container exited immediately on every start. Go through package.json so the
# entrypoint cannot drift from the script again.
CMD ["npm", "run", "start:prod"]
