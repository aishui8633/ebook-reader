FROM node:20-alpine

WORKDIR /app

# 复制 package.json
COPY package.json ./

# 安装依赖
RUN npm install --production

# 复制应用代码
COPY . .

# 创建书籍目录挂载点
RUN mkdir -p /books

# 暴露端口
EXPOSE 8374

# 启动命令
CMD ["node", "server.js"]
