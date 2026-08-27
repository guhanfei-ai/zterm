import { describe, it, expect } from 'vitest'
import { useConfirm } from '../useConfirm'

// useConfirm 是模块级单例，测试顺序敏感：每个用例都先消化掉上一个待答状态
describe('useConfirm', () => {
  it('confirm 路径以 true settle', async () => {
    const { confirm, confirmState } = useConfirm()
    const promise = confirm('标题', '内容')
    expect(confirmState.value.show).toBe(true)
    confirmState.value.onConfirm()
    await expect(promise).resolves.toBe(true)
    expect(confirmState.value.show).toBe(false)
  })

  it('cancel 路径以 false settle', async () => {
    const { confirm, confirmState } = useConfirm()
    const promise = confirm('标题', '内容')
    confirmState.value.onCancel()
    await expect(promise).resolves.toBe(false)
    expect(confirmState.value.show).toBe(false)
  })

  it('新 show 覆盖旧确认框时，旧 Promise 以 false（取消语义）settle，不会永远挂起', async () => {
    const { confirm, confirmState } = useConfirm()
    const first = confirm('删除主机', '确定删除吗？')
    const second = confirm('下载更新', '现在下载吗？')

    // 旧 Promise 应已被取消语义 settle
    await expect(first).resolves.toBe(false)
    // 新确认框正常展示并可独立作答
    expect(confirmState.value.show).toBe(true)
    expect(confirmState.value.title).toBe('下载更新')
    confirmState.value.onConfirm()
    await expect(second).resolves.toBe(true)
  })
})
