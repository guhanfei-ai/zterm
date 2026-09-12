<template>
  <div class="settings-sidebar">
    <div class="sidebar-header">
      <button class="btn-back" @click="$emit('back')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        <span>返回</span>
      </button>
    </div>
    <nav class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: activeSection === item.id }"
        @click="$emit('navigate', item.id)"
      >
        <span class="nav-icon" v-html="item.icon"></span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  activeSection: string
}>()

defineEmits<{
  back: []
  navigate: [section: string]
}>()

const navItems = [
  {
    id: 'model',
    label: '模型',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
  },
  {
    id: 'appearance',
    label: '外观',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><path d="M17.5 10.5a2.5 2.5 0 1 0 0-5"/><circle cx="8.5" cy="8.5" r="2.5"/><circle cx="11" cy="14" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/></svg>'
  },
  {
    id: 'terminal',
    label: '终端',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>'
  },
  {
    id: 'about',
    label: '关于',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  }
]
</script>

<style scoped>
.settings-sidebar {
  width: 210px;
  flex-shrink: 0;
  background: var(--surface-muted);
  border-right: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px 12px 12px;
  border-bottom: 1px solid var(--divider-soft);
}

.btn-back {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
  width: 100%;
}

.btn-back:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.sidebar-nav {
  padding: 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  padding-left: 14px;
  background: transparent;
  border: none;
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  width: 100%;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
  transition: height var(--transition-normal);
}

.nav-item:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.nav-item:hover::before {
  height: 16px;
}

.nav-item.active {
  background: var(--surface);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.nav-item.active::before {
  height: 20px;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  transition: color var(--transition-fast);
}

.nav-item.active .nav-icon {
  color: var(--accent);
}
</style>
