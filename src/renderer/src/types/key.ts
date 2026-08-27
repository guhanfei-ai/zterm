export interface KeyRecord {
  id: string
  name: string
  type: 'ssh-private-key'
  privateKey: string
  passphrase?: string
  createdAt: string
  updatedAt: string
}
