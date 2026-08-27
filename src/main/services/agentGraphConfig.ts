/**
 * agentGraphConfig — Agent Graph 硬编码常量集中管理
 *
 * 从 agentGraph.ts 中提取的配置常量，便于统一调整和复用。
 */

/** 单步执行超时（毫秒） */
export const STEP_TIMEOUT_MS = 30_000

/**
 * 总结阶段超时（毫秒）
 * 总结是 token 最重的一次模型调用（system prompt + 全部步骤的 plan/command/observation + 终端上下文 + 推理 token），
 * 超时阈值必须不低于普通步骤，否则常在产出正文前被判超时落入兜底结论。放宽到 60s。
 */
export const SUMMARY_TIMEOUT_MS = 60_000

/** 兜底只读观察命令（repair 节点在模型不出命令时的最小兜底） */
export const FALLBACK_COMMAND = 'ps aux --sort=-%cpu | head -20'

/** 总结裁剪：单条 observation 最大保留长度 */
export const MAX_OBS_LEN = 800

/** 总结裁剪：observation 保留头部字符数 */
export const OBS_HEAD = 400

/** 总结裁剪：observation 保留尾部字符数 */
export const OBS_TAIL = 400
