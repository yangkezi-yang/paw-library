# 独立域名部署版

该版本直接在 Render 提供网页，不再把手机浏览器跳转到 chatgpt.site。前端样式和功能保持不变，Node 服务端通过正式的服务访问凭据连接现有云端文件接口，因此不需要复制或迁移用户上传的文件。

## 发布前置条件

1. 连接网站所有者的 Render 账号，并授权读取 GitHub 的 `yangkezi-yang/paw-library` 仓库。
2. 将本目录的配置合并到主分支后，用根目录 `render.yaml` 创建免费 Web Service。
3. 仅在托管服务的服务端环境变量中配置 `UPSTREAM_SITE_TOKEN`。凭据不得放进 GitHub、前端代码、网页地址或日志。
4. 发布后将 GitHub Pages 入口改为 Render 实际返回的新地址，并在手机上验证。当前配置文件不代表已经发布。

## 开发与验证

```bash
cd standalone
npm install
npm test
npm run build
# 在服务端环境中配置 UPSTREAM_SITE_TOKEN 后：
npm start
```

上传文件继续使用原有云端存储，不依赖 Render 临时磁盘。免费实例的冷启动可能需要等待。手机可访问性需要用新地址实测，不能仅凭配置保证。
