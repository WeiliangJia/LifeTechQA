FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /tests

COPY package.json ./
RUN npm install

COPY . .

# Run headless by default in container
ENV HEADLESS=true

CMD ["npx", "playwright", "test", "--reporter=list"]
