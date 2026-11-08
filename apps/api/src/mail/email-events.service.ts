import { Injectable, Logger } from '@nestjs/common';
import type { EmailEventsInput, EmailEventsResult } from '@iconbridge/shared';
import { Clock } from '../common/clock/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addressHash, SUPPRESSING_STATUSES } from './email-suppression.js';

const VALIDATION = 'Microsoft.EventGrid.SubscriptionValidationEvent';
const DELIVERY_REPORT = 'Microsoft.Communication.EmailDeliveryReportReceived';

/**
 * Delivery reports of Azure Communication Services, through Event Grid (audit M2). A hard
 * bounce, or an address Azure itself suppresses, goes into `email_suppressions`, and
 * `MailService` sends nothing more to it. Other statuses (delivered, spam filter, quarantine,
 * temporary failures) change nothing.
 */
@Injectable()
export class EmailEventsService {
  private readonly logger = new Logger(EmailEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** The answer Event Grid expects when a subscription is created, if this is that request. */
  validationResponse(events: EmailEventsInput): string | undefined {
    const code = events.find((event) => event.eventType === VALIDATION)?.data['validationCode'];
    return typeof code === 'string' ? code : undefined;
  }

  async record(events: EmailEventsInput): Promise<EmailEventsResult> {
    const now = this.clock.now();
    let suppressed = 0;
    for (const event of events) {
      if (event.eventType !== DELIVERY_REPORT) {
        continue;
      }
      const { recipient, status } = event.data;
      if (typeof recipient !== 'string' || typeof status !== 'string') {
        continue;
      }
      if (!Object.hasOwn(SUPPRESSING_STATUSES, status)) {
        continue;
      }
      const reason = SUPPRESSING_STATUSES[status as keyof typeof SUPPRESSING_STATUSES];
      await this.prisma.emailSuppression.upsert({
        where: { emailHash: addressHash(recipient) },
        create: { emailHash: addressHash(recipient), reason, lastEventAt: now },
        update: { reason, lastEventAt: now },
      });
      suppressed += 1;
    }
    if (suppressed > 0) {
      // Counts only: an address is personal data.
      this.logger.warn(`Email delivery reports: ${suppressed} address(es) marked undeliverable`);
    }
    return { suppressed };
  }
}
