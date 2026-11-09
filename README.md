# 猫爪资源库 · Paw Library

蓝绿色马卡龙主题的短剧视频与文档资源网站。

## 直接使用

- 正式网站：https://mint-paw-studio-1109.workspace-682598.chatgpt.site/
- 视频页面：https://mint-paw-studio-1109.workspace-682598.chatgpt.site/#videos
- 文档页面：https://mint-paw-studio-1109.workspace-682598.chatgpt.site/#documents
- 管理后台：https://mint-paw-studio-1109.workspace-682598.chatgpt.site/#admin
- GitHub 网页入口：https://yangkezi-yang.github.io/paw-library/

GitHub 网页入口会自动跳转到正式网站；旧的 `admin.html` 链接也会自动进入可用后台。当前按需求开放免登录管理，持有链接的人可以上传、编辑和删除资源。

## 当前功能

- 前台视频展示、分类、搜索与在线播放。
- 前台文档展示与完整附件下载，管理操作集中在后台。
- 3:4 竖版文档封面，封面右侧显示名称、分类与简介。
- 后台视频与文档上传、文档编辑、替换文件、替换或移除封面、删除资源。
- 猫爪元素、轻动态、动效开关，适配电脑、平板与手机。
- 文件和封面保存到云端，换电脑后仍可查看。

## 完整应用源码

最新版前端、后端接口与构建配置位于 [`site/`](./site/)。来源版本记录见 [`site/SOURCE_VERSION.json`](./site/SOURCE_VERSION.json)。

GitHub Pages 只托管静态入口，不能直接运行文件上传接口。正式网站使用 Cloudflare Workers 与 R2 文件存储，GitHub 存放可查看和下载的源码快照。当前没有把 GitHub Push 配置成线上应用的自动部署触发器。

原有根目录 Node.js 示例和静态文件保留用于历史参考，当前可用版本以 `site/` 和上方正式网站为准。用户上传的视频、文档与封面未放入此公开仓库。

本地开发方式见 [`site/README.md`](./site/README.md)。
