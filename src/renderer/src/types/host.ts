export interface HostRecord {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key' | 'privateKeyFile'
  password?: string
  keyId?: string
  privateKeyFilePath?: string
  privateKeyFileName?: string
  privateKeyFilePassphrase?: string
  description?: string
  createdAt: string
  updatedAt: string
}
