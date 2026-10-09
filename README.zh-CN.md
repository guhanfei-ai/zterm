# zTerm

[English](./README.md) | 简体中文

zTerm 是一个开源的 Electron 终端应用，提供可选的 AI 辅助能力，支持 SSH 与 Jumpserver 连接。

**普通用户请先阅读 [使用指南](./_docs/USERGUIDE.zh-CN.md)**（安装、主机配置、导入导出、常见报错排查）。

## 功能速览

- 本地终端、SSH 直连（主机指纹确认 / 断线原标签重连）、Jumpserver 资产浏览与连接
- 终端搜索（`Cmd/Ctrl+F`）与终端记录导出
- 主机列表导出为 OpenSSH config（不含密码与私钥内容）
- 工作区与 AI 聊天记录持久化，重启后可恢复
- Chat / Agent 两种 AI 模式，可附带终端上下文；Agent 默认读模式，用内置工具查看目录、文件、文本、系统、进程和端口；开启读写模式后自动执行受安全策略约束的命令，高危命令一律拦截

## 开发

```bash
npm ci
cp .env.example .env
npm run dev
```

在应用内「设置 → 模型服务」配置地址、模型及 API 密钥即可启用 AI。Agent 默认使用固定版本的 Pi SDK；模型需要支持原生工具调用。命令使用受限 shell 语法，解释器、命令替换及不明确的命令会被拒绝。SSH 主机和 Jumpserver 实例均在应用内配置；项目不内置任何服务器或凭据。

内置读工具复用已绑定的本地、SSH 或 Jumpserver 终端，远端无需安装 zTerm 组件。文件读取和搜索有大小上限，文本搜索目前只覆盖单文件或目录直接子文件；端口查询使用目标已有的 ss 或 lsof，权限不足或工具缺失会如实返回。读模式不开放 AI 自行拼装命令的入口；原执行实现保留供读写模式使用。切回读模式后，尚未下发的通用命令会被拒绝。

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

`main` 为稳定分支，`dev` 为集成分支，短生命周期的 `dev/<topic>` 或 `feature/<topic>` 分支用于承载具体功能开发。每次 push 和 pull request 时，GitHub Actions 会运行类型检查、测试、生产依赖审计及代码构建；只有在推送 `v*` 标签时，才会构建安装包。正式 macOS 发布要求签名与公证，Windows 要求签名及发布者身份配置；缺少凭据时发布会失败，不会上传未验证的正式安装包。

## 许可证

MIT
