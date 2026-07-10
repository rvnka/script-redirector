FROM node:24-alpine
WORKDIR /app
COPY . .
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
