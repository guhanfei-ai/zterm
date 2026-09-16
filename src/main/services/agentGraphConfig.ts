/**
 * agentGraphConfig — Agent Graph 硬编码常量集中管理
 *
 * 从 agentGraph.ts 中提取的配置常量，便于统一调整和复用。
 */

/** 单步执行超时（毫秒） */
export const STEP_TIMEOUT_MS = 30_000

/** 兜底只读观察命令（repair 节点在模型不出命令时的最小兜底） */
export const FALLBACK_COMMAND = 'ps aux --sort=-%cpu | head -20'
