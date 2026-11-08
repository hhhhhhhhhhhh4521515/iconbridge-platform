import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AppException } from '../common/errors/app.exception.js';
import { EmailEventsController } from './email-events.controller.js';
import type { EmailEventsService } from './email-events.service.js';

function controller(key: string) {
  const events = {
    validationResponse: vi.fn(() => undefined),
    record: vi.fn(() => Promise.resolve({ suppressed: 1 })),
  };
  const config = { get: () => key } as unknown as ConfigService<Env, true>;
  return {
    events,
    controller: new EmailEventsController(events as unknown as EmailEventsService, config),
  };
}

const BODY = [{ eventType: 'Microsoft.Communication.EmailDeliveryReportReceived', data: {} }];

describe('EmailEventsController', () => {
  it('answers 404 and reads nothing while EMAIL_EVENTS_KEY is empty', async () => {
    const { events, controller: off } = controller('');
    const error = await off.receive(BODY, 'anything').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(404);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('records the reports with the right key only', async () => {
    const key = 'k'.repeat(32);
    const { events, controller: on } = controller(key);
    await expect(on.receive(BODY, key)).resolves.toEqual({ suppressed: 1 });
    await expect(on.receive(BODY, `${key}x`)).rejects.toBeInstanceOf(AppException);
    expect(events.record).toHaveBeenCalledTimes(1);
  });
});
