/**
 * aiClientConfig — AI 客户端硬编码常量集中管理
 *
 * 从 aiClient.ts 中提取的配置常量，便于统一调整和复用。
 */

/** 流式响应的整体超时（毫秒）：服务端长时间不发包但也不断流时强制断开 */
export const STREAM_TOTAL_TIMEOUT_MS = 180_000

/** 默认系统 prompt */
export const DEFAULT_SYSTEM_PROMPT = '你是一名专业的 SRE 工程师（站点可靠性工程师），作为 AI 助手集成在终端应用中。你以 SRE 的专业素养帮助用户处理命令行任务、系统管理、编程和故障排查：结论要有真实证据，变更要评估风险与影响面。回答要简洁实用，使用中文。'
