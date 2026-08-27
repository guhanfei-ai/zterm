import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { KeyRecord } from '../types/key'

export const useKeysStore = defineStore('keys', () => {
  const keys = ref<KeyRecord[]>([])
  const loading = ref(false)

  async function fetchKeys(): Promise<void> {
    loading.value = true
    try {
      keys.value = await window.electronAPI.keys.list()
    } finally {
      loading.value = false
    }
  }

  async function createKey(data: {
    name: string
    privateKey: string
    passphrase?: string
  }): Promise<KeyRecord> {
    const record = await window.electronAPI.keys.create(data)
    await fetchKeys()
    return record
  }

  async function updateKey(
    id: string,
    data: { name?: string; privateKey?: string; passphrase?: string }
  ): Promise<KeyRecord | null> {
    const updated = await window.electronAPI.keys.update(id, data)
    if (updated) {
      await fetchKeys()
    }
    return updated
  }

  async function deleteKey(id: string): Promise<boolean> {
    const result = await window.electronAPI.keys.delete(id)
    if (result) {
      await fetchKeys()
    }
    return result
  }

  return { keys, loading, fetchKeys, createKey, updateKey, deleteKey }
})
