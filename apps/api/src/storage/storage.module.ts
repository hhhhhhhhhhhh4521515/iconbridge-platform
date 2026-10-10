import { Global, Module } from '@nestjs/common';
import { AzureStorageService } from './azure-storage.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: AzureStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
