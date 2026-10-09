/**
 * 内置观察工具：模型只填写查询参数，宿主生成固定的只读操作。
 * 经现有绑定终端执行，不安装远端组件，不开放额外命令或主机参数。
 */
import { posix } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

export interface ReadExecutionDetails {
  command?: string
  displayOutput?: string
  blocked?: boolean
  error?: string
  reason?: string
  stepNumber?: number
  fidelity?: string
  exitCode?: number
  duration?: number
  truncated?: boolean
  output?: string
}

export interface PreparedRead {
  toolName: string
  label: string
  command: string
  scope: string
}

export type ReadExecutor = (
  toolCallId: string,
  prepare: () => PreparedRead,
  signal?: AbortSignal,
) => Promise<AgentToolResult<ReadExecutionDetails>>

const SOURCE_BYTES = 65_536
const OUTPUT_BYTES = 8_000
const pathParam = Type.String({ description: '目标上的绝对路径；不展开 ~、变量或通配符', maxLength: 2048 })
const objectOptions = { additionalProperties: false }

const definitions = [
  {
    name: 'read_bound_directory',
    label: '查看目录',
    description: '查看已绑定目标的目录直接子项和文件属性，不递归。数量与输出有上限。',
    parameters: Type.Object({
      path: pathParam,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
    }, objectOptions),
  },
  {
    name: 'read_bound_file',
    label: '读取文件',
    description: '读取已绑定目标的普通文本文件或已支持的 /proc 信息。默认读取开头，from_end 可读取日志末尾。单次源数据最多 64 KiB；拒绝设备、管道和常见凭据文件。',
    parameters: Type.Object({
      path: pathParam,
      start_line: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000, default: 1 })),
      max_lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
      from_end: Type.Optional(Type.Boolean({ default: false })),
    }, objectOptions),
  },
  {
    name: 'search_bound_text',
    label: '搜索文本',
    description: '在已绑定目标的一个文本文件或目录直接子文件中做字面关键词搜索，不执行正则或脚本，不递归。目录最多检查 100 个文件，每个文件最多检查前 64 KiB；跳过符号链接和常见凭据文件。',
    parameters: Type.Object({
      path: pathParam,
      query: Type.String({ minLength: 1, maxLength: 256 }),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
    }, objectOptions),
  },
  {
    name: 'read_bound_system',
    label: '查看系统概况',
    description: '读取已绑定目标的系统版本、运行时间、负载、内存和磁盘信息。支持 Linux，macOS 使用已有系统查询。缺失能力如实返回，不安装软件。',
    parameters: Type.Object({}, objectOptions),
  },
  {
    name: 'list_bound_processes',
    label: '查看进程',
    description: '读取已绑定目标的进程 PID、父进程、用户、状态、CPU、内存和名称；不读取环境变量或完整启动参数。可按 PID 或名称过滤。',
    parameters: Type.Object({
      pid: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
    }, objectOptions),
  },
  {
    name: 'list_bound_sockets',
    label: '查看端口和连接',
    description: '使用目标现有的 ss 查询 TCP/UDP socket，缺少 ss 时使用已有 lsof。默认只看监听或未连接绑定项。返回当前网络命名空间可见的信息；进程信息可能受权限限制。不探测外部可达性，不安装软件。',
    parameters: Type.Object({
      protocol: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('tcp'), Type.Literal('udp')])),
      local_port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
      listening_only: Type.Optional(Type.Boolean({ default: true })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
    }, objectOptions),
  },
] as const

export const BUILTIN_READ_TOOL_NAMES: readonly string[] = definitions.map((definition) => definition.name)

export function activeTerminalToolNames(allowWrite: boolean): string[] {
  return [
    'read_bound_terminal_context',
    ...BUILTIN_READ_TOOL_NAMES,
    ...(allowWrite ? ['execute_bound_terminal'] : []),
  ]
}

function quote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(field + ' 必须是长度受限且不包含控制字符的文本')
  }
  return value
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : value
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
    throw new Error('数值参数超出允许范围')
  }
  return number
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('布尔参数格式无效')
  return value
}

/** 路径解析后的远端目标还会检查同一边界，避免符号链接绕过。 */
const deniedPathCases = [
  '/dev|/dev/*|/sys|/sys/*',
  '/etc/shadow|/etc/gshadow|/etc/shadow-*|/etc/gshadow-*',
  '*/.ssh|*/.ssh/*|*/.aws|*/.aws/*|*/.kube|*/.kube/*',
  '*/.env|*/.env.*|*/credentials|*/credentials.*|*/secrets|*/secrets.*|*.[pP][eE][mM]|*.[kK][eE][yY]',
].join('|')
const allowedProcCases = '/proc/meminfo|/proc/loadavg|/proc/uptime|/proc/cpuinfo|/proc/version|/proc/net/tcp|/proc/net/tcp6|/proc/net/udp|/proc/net/udp6'

function filePath(value: unknown): string {
  const path = text(value, 'path', 2048)
  if (!path.startsWith('/')) throw new Error('请使用目标上的绝对路径')
  const normalized = posix.normalize(path)
  if (/^\/(?:dev|sys)(?:\/|$)/.test(normalized)
    || /^\/etc\/(?:shadow|gshadow)(?:-|$)/.test(normalized)
    || /\/\.(?:ssh|aws|kube)(?:\/|$)/.test(normalized)
    || /\/(?:\.env(?:\..*)?|credentials(?:\..*)?|secrets(?:\..*)?)$/.test(normalized)
    || /\.(?:pem|key)$/i.test(normalized)) {
    throw new Error('该路径属于设备或凭据范围，内置读工具不开放')
  }
  return normalized
}

function pathPrelude(path: string): string {
  return 'p=' + quote(path)
    + '; if command -v realpath >/dev/null 2>&1; then p=$(command realpath "$p") || exit 2'
    + '; elif command -v readlink >/dev/null 2>&1; then p=$(command readlink -f "$p") || exit 2'
    + '; else printf "%s\\n" "路径解析能力不可用"; exit 2; fi'
    + '; case "$p" in ' + deniedPathCases + ') printf "%s\\n" "该路径属于设备或凭据范围，读取被拒绝"; exit 2;; esac'
    + '; case "$p" in ' + allowedProcCases + ') ;; /proc|/proc/*) printf "%s\\n" "该 /proc 接口尚未开放"; exit 2;; esac; '
}

/** 仅由六个固定操作生成命令，未知字段和非枚举参数无法进入执行链路。 */
export function prepareBuiltinRead(name: string, params: Record<string, unknown>): PreparedRead {
  const definition = definitions.find((item) => item.name === name)
  if (!definition) throw new Error('未知内置读工具')
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('查询参数格式无效')
  const allowed = Object.keys(definition.parameters.properties)
  if (Object.keys(params).some((key) => !allowed.includes(key))) throw new Error('查询包含未支持的参数')
  let command: string
  let scope = '当前绑定目标'

  switch (name) {
    case 'read_bound_directory': {
      const path = filePath(params.path)
      const limit = integer(params.limit, 50, 1, 200)
      command = pathPrelude(path)
        + 'if [ ! -d "$p" ]; then printf "%s\\n" "路径不是目录"; exit 2; fi; '
        + 'LC_ALL=C command ls -lna "$p" | command head -n ' + (limit + 3)
      scope += '，目录直接子项，最多 ' + limit + ' 项'
      break
    }
    case 'read_bound_file': {
      const path = filePath(params.path)
      const start = integer(params.start_line, 1, 1, 10000)
      const lines = integer(params.max_lines, 100, 1, 500)
      const fromEnd = boolean(params.from_end, false)
      if (fromEnd && start !== 1) throw new Error('读取末尾时不能同时指定 start_line')
      const window = fromEnd
        ? 'command tail -c ' + SOURCE_BYTES + ' "$p" | command tail -n ' + lines
        : 'command head -c ' + SOURCE_BYTES + ' "$p" | command awk '
          + quote('NR >= ' + start + ' { print NR ":" $0; n++; if (n >= ' + lines + ') exit }')
      command = pathPrelude(path)
        + 'if [ ! -f "$p" ] || [ ! -r "$p" ]; then printf "%s\\n" "路径不是可读普通文件"; exit 2; fi; '
        + window
      scope += fromEnd ? '，文件末尾窗口，最多 64 KiB' : '，文件开头 64 KiB 内的行窗口'
      break
    }
    case 'search_bound_text': {
      const path = filePath(params.path)
      const query = text(params.query, 'query', 256)
      const matches = integer(params.max_matches, 30, 1, 100)
      command = pathPrelude(path) + 'q=' + quote(query) + '; count=0; unread=0; '
        + 'if [ ! -r "$p" ] || { [ -d "$p" ] && [ ! -x "$p" ]; }; then printf "%s\\n" "搜索路径不可读或目录不可访问"; exit 2; fi; '
        + 'if ! command -v grep >/dev/null 2>&1; then printf "%s\\n" "grep: command not found"; exit 127; fi; '
        + 'if [ -f "$p" ]; then set -- "$p"; elif [ -d "$p" ]; then set -- "$p"/* "$p"/.[!.]* "$p"/..?*'
        + '; else printf "%s\\n" "路径不是普通文件或目录"; exit 2; fi; '
        + 'for f do [ -f "$f" ] && [ ! -L "$f" ] || continue; '
        + 'case "$f" in ' + deniedPathCases + ') continue;; esac; '
        + 'if [ ! -r "$f" ]; then unread=$((unread+1)); continue; fi; '
        + '[ "$count" -lt 100 ] || break; count=$((count+1)); printf "\\nFILE %s\\n" "$f"; '
        + 'command head -c ' + SOURCE_BYTES + ' "$f" | command grep -n -F -m ' + matches + ' -e "$q"; '
        + 'done; printf "\\n搜索范围：已检查 %s 个文件，跳过 %s 个不可读文件。\\n" "$count" "$unread"; exit 0'
      scope += '，非递归字面搜索，最多 100 个文件，每文件前 64 KiB'
      break
    }
    case 'read_bound_system':
      command = 'printf "%s\\n" "=== 系统 ==="; command uname -s; command uname -r; '
        + 'printf "%s\\n" "=== 运行时间与负载 ==="; command uptime; '
        + 'printf "%s\\n" "=== 内存 ==="; '
        + 'if [ -r /proc/meminfo ]; then command head -n 8 /proc/meminfo; '
        + 'elif command -v vm_stat >/dev/null 2>&1; then command vm_stat; '
        + 'else printf "%s\\n" "内存查询能力不可用"; fi; '
        + 'printf "%s\\n" "=== 磁盘 ==="; command df -Pk | command head -n 40'
      break
    case 'list_bound_processes': {
      const limit = integer(params.limit, 50, 1, 200)
      const pid = params.pid === undefined ? undefined : integer(params.pid, 1, 1, 2147483647)
      const nameFilter = params.name === undefined ? undefined : text(params.name, 'name', 128)
      command = 'LC_ALL=C command ps ' + (pid ? '-p ' + pid : '-e')
        + ' -o pid,ppid,user,stat,pcpu,pmem,comm'
        + (nameFilter ? ' | command grep -F -e ' + quote(nameFilter) : '')
        + ' | command head -n ' + (limit + 1)
      scope += '，当前账号可见进程，最多 ' + limit + ' 项'
      break
    }
    case 'list_bound_sockets': {
      const protocol = params.protocol ?? 'all'
      if (!['all', 'tcp', 'udp'].includes(protocol as string)) throw new Error('protocol 必须是 all、tcp 或 udp')
      const port = params.local_port === undefined ? undefined : integer(params.local_port, 1, 1, 65535)
      const listening = boolean(params.listening_only, true)
      const limit = integer(params.limit, 50, 1, 200)
      const ssQuery = 'LC_ALL=C command ss -H -n -t -u -p' + (listening ? ' -l' : ' -a')
        + (port ? ' ' + quote('sport = :' + port) : '')
        + (protocol !== 'all' ? ' | command grep -E ' + quote('^' + protocol + '[[:space:]]') : '')
        + ' | command head -n ' + limit
      const lsofQueries = (['tcp', 'udp'] as const).filter((kind) => protocol === 'all' || protocol === kind)
        .map((kind) => 'LC_ALL=C command lsof -nP +c 0 -i' + kind.toUpperCase()
          + (port ? ':' + port : '') + (kind === 'tcp' && listening ? ' -sTCP:LISTEN' : '')
          + (port || kind === 'udp' && listening ? ' | command awk ' + quote(
            'NR == 1 || (' + (port ? '$9 ~ /^[^>]*:' + port + '(->|$)/' : '1')
            + (kind === 'udp' && listening ? ' && $9 !~ /->/' : '') + ')'
          ) : '')
          + ' | command head -n ' + (limit + 1)).join('; ')
      command = 'if command -v ss >/dev/null 2>&1; then ' + ssQuery
        + '; elif command -v lsof >/dev/null 2>&1; then ' + lsofQueries
        + '; else printf "%s\\n" "ss/lsof: command not found；本环境暂不支持端口查询"; exit 127; fi'
      scope += '，当前网络命名空间，进程信息受账号权限限制'
      break
    }
    default: throw new Error('未知内置读工具')
  }
  const label = definition.label + (params.path ? '：' + String(params.path)
    : params.local_port ? '：' + String(params.local_port) : '')
  return { toolName: name, label, command, scope }
}

function socketRecords(output: string): Array<Record<string, unknown>> | undefined {
  const records: Array<Record<string, unknown>> = []
  for (const line of output.split('\n')) {
    const words = line.trim().split(/\s+/)
    if (words[0] === 'tcp' || words[0] === 'udp') {
      if (words.length < 6) continue
      const process = words.slice(6).join(' ')
      const pid = process.match(/pid=(\d+)/)?.[1]
      const endpoint = words[4]
      const separator = endpoint.lastIndexOf(':')
      records.push({
        protocol: words[0], state: words[1],
        localAddress: separator < 0 ? endpoint : endpoint.slice(0, separator),
        localPort: separator < 0 || !/^\d+$/.test(endpoint.slice(separator + 1))
          ? null : Number(endpoint.slice(separator + 1)),
        peer: words[5],
        pid: pid ? Number(pid) : null,
        processInfo: process || null,
      })
    } else if (/^\d+$/.test(words[1] ?? '') && ['TCP', 'UDP'].includes(words[7])) {
      const endpoint = words[8]?.split('->')[0] ?? ''
      const separator = endpoint.lastIndexOf(':')
      records.push({
        protocol: words[7].toLowerCase(), state: line.match(/\(([^)]+)\)$/)?.[1] ?? 'BOUND',
        localAddress: endpoint.slice(0, separator),
        localPort: /^\d+$/.test(endpoint.slice(separator + 1)) ? Number(endpoint.slice(separator + 1)) : null,
        pid: Number(words[1]), processInfo: words[0],
        peer: words[8]?.split('->')[1] ?? null,
      })
    }
  }
  // 格式不认识时保留原始证据，不把解析失败误报为“没有端口”。
  return records.length || !output.trim() ? records : undefined
}

export function createBuiltinReadTools(execute: ReadExecutor): ToolDefinition[] {
  return definitions.map((definition) => defineTool({
    ...definition,
    executionMode: 'sequential',
    async execute(toolCallId, params, signal) {
      let prepared: PreparedRead | undefined
      const result = await execute(toolCallId, () => {
        prepared = prepareBuiltinRead(definition.name, params as Record<string, unknown>)
        return prepared
      }, signal)
      const output = result.details.output
      if (output === undefined || result.details.fidelity !== 'verified') return {
        ...result,
        content: result.content.map((item) => item.type === 'text' && prepared
          ? { ...item, text: item.text.replaceAll(prepared.command, prepared.label) } : item),
        details: { ...result.details, command: prepared?.label ?? definition.label },
      }
      const binary = output.includes('\x00')
      const displayOutput = binary ? '文件包含二进制数据，当前文本读取不支持。' : output || '(当前范围内没有结果)'
      const records = definition.name === 'list_bound_sockets' ? socketRecords(output) : undefined
      const details = { ...result.details, command: prepared?.label ?? definition.label,
        displayOutput, output: undefined, toolName: definition.name, scope: prepared?.scope,
        observedAt: new Date().toISOString(), binary, sourceByteLimit: SOURCE_BYTES,
        warnings: definition.name === 'list_bound_sockets' ? ['所属进程信息可能受权限限制；查询范围是当前网络命名空间'] : [] }
      return {
        ...result,
        content: [{ type: 'text', text: binary ? '文件包含二进制数据，当前文本读取不支持。'
          : JSON.stringify({ tool: definition.name, scope: prepared?.scope, exitCode: details.exitCode,
            observedAt: details.observedAt, truncated: details.truncated,
            records, output: output.slice(0, OUTPUT_BYTES) || '(当前范围内没有结果)', warnings: details.warnings }) }],
        details,
      }
    },
  }))
}
