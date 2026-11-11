export interface UpdateState {
  status:
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error'
    | 'unavailable';
  currentVersion: string;
  version?: string;
  checkedAt?: string;
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number };
  error?: string;
  retry?: 'check' | 'download' | 'install';
}

export interface UpdateApi {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  cancel(): Promise<void>;
  install(): Promise<void>;
  confirmLaunch(): Promise<void>;
  onChange(listener: (state: UpdateState) => void): () => void;
  onOpen(listener: () => void): () => void;
}
