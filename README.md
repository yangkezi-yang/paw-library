# Paw Library｜猫爪资源空间

一个蓝绿色马卡龙风格的视频与文档资源网站，包含公开前台和无登录后台。

## 功能
- 前台视频列表：读取后台上传的视频，支持网页内播放。
- 前台文档列表：显示文件名、大小、上传日期，支持下载原文件。
- 后台视频上传：MP4、MOV、WEBM、MKV，单文件最大 1GB。
- 后台文档上传：PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、TXT、RTF、CSV、MD。
- 后台资源管理：查看资源并删除，前台同步更新。
- 元数据保存于 `data/resources.json`，文件保存于 `uploads/`。

## 本地运行
需要 Node.js 18 或更高版本。

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000/`，后台为 `http://localhost:3000/admin.html`。

## 部署
使用支持 Node.js 18+ 的服务，启动命令 `npm start`。务必为 `data/` 和 `uploads/` 配置持久化磁盘，否则重新部署后上传内容可能丢失。当前后台未设置登录，公开部署前应增加管理员认证、上传限制与备份。
