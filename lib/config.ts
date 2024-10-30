export interface Mapping {
  [key: string]: string[]
}

export interface MailForwarderConfig {
  readonly domain: string
  readonly forwardMapping: Mapping
  readonly priority?: number
  readonly scan?: boolean
  readonly bucket?: string
  readonly prefix?: string
}

export interface BackEndConfig {
  readonly mailForwarder: MailForwarderConfig
}

export interface AppConfig {
  readonly name: string
  readonly backend: BackEndConfig
}
