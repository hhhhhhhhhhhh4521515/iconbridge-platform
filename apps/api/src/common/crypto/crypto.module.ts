import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { FieldCipher } from './field-cipher.js';

/** Provides the cipher of the passport column, built from PASSPORT_ENCRYPTION_KEY. */
@Global()
@Module({
  providers: [
    {
      provide: FieldCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FieldCipher(config.get('PASSPORT_ENCRYPTION_KEY', { infer: true })),
    },
  ],
  exports: [FieldCipher],
})
export class CryptoModule {}
