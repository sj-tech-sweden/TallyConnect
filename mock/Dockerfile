FROM node:20-slim

WORKDIR /app

COPY scripts/mock-atem-node.js /app/mock-atem-node.js

EXPOSE 9910/udp
EXPOSE 9932

ENV ATEM_MOCK_ADDRESS=0.0.0.0
ENV ATEM_MOCK_HTTP_PORT=9932

CMD ["node", "/app/mock-atem-node.js"]
