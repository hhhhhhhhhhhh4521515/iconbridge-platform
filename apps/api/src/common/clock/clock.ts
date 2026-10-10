import { Global, Injectable, Module } from '@nestjs/common';

/**
 * The current time. Business rules that depend on dates (re-application cooldown,
 * age, passport expiry) read it from here, so tests can move time forward.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
