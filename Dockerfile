FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache \
    sqlite \
    bash \
    curl \
    && rm -rf /var/cache/apk/*

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN chmod +x scripts/*.sh && \
    chmod +x index.sh

RUN mkdir -p output && \
    chmod 777 output

USER 1000:1000

EXPOSE 3000

VOLUME ["/app/output"]

CMD ["./index.sh"]