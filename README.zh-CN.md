# zTerm

[English](./README.md) | 简体中文

zTerm 是一个开源的 Electron 终端应用，提供可选的 AI 辅助能力，支持 SSH 与 Jumpserver 连接。

**普通用户请先阅读 [使用指南](./_docs/USERGUIDE.zh-CN.md)**（安装、主机配置、导入导出、常见报错排查）。

## 功能速览

- 本地终端、SSH 直连（主机指纹确认 / 断线原标签重连）、Jumpserver 资产浏览与连接
- 终端搜索（`Cmd/Ctrl+F`）与终端记录导出
- 主机列表导出为 OpenSSH config（不含密码与私钥内容）
- 工作区与 AI 聊天记录持久化，重启后可恢复
- Chat / Agent 两种 AI 模式，可附带终端上下文，命令有安全检查与二次确认

## 开发

```bash
npm ci
cp .env.example .env
npm run dev
```

设置 `OPENAI_API_KEY` 即可启用 AI 功能。SSH 主机和 Jumpserver 实例均在应用内配置；项目不内置任何服务器或凭据。

## 打包

发布脚本遵循项目统一使用的四阶段工作流：

```bash
./deploy.sh release       # 更新版本号、创建 release 提交与 tag，并推送（仅限 main 分支）
./deploy.sh build         # 校验并打包当前系统（Mac 上默认为 macOS）
./deploy.sh publish       # 将 builds/ 上传到对应的 GitHub Release
./deploy.sh all           # release → build → publish 一键执行
```

如需本地指定平台，可使用 `./deploy.sh build mac`、`win` 或 `linux`。发布仅面向 GitHub Releases，不捆绑任何凭据或第三方存储配置。

## 分支与 CI

`main` 为稳定分支，`dev` 为集成分支，短生命周期的 `dev/<topic>` 或 `feature/<topic>` 分支用于承载具体功能开发。每次 push 和 pull request 时，GitHub Actions 会运行类型检查与测试；只有在推送 `v*` 标签时，才会构建 macOS、Windows 和 Linux 安装包并发布到 GitHub Release。

## 许可证

MIT
