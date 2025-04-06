export type StorageAdapter = {
  get: (key: string) => Promise<any>;
  set: (key: string, val: any) => Promise<void>;
};
