import { defineConfig } from 'vitest/config'

/**
 * I02:测试隔离闭环。
 *
 * setupFiles 在每个测试文件的导入**之前**执行 —— 环境变量先于
 * dataPath.ts / piModelAdapter.ts 的模块级求值生效,持久化根
 * (ZTERM_DATA_ROOT / PI_AGENT_DIR / HOME / TMPDIR)全部指向
 * 测试拥有的唯一目录,测试不再触碰真实 home 或共享 /tmp。
 */
export default defineConfig({
  test: {
    // 只收集当前仓库 src；工作区旁挂的只读 worktree/构建产物不能混入主项目验收。
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
