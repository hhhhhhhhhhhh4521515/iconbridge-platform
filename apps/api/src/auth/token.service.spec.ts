import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  const service = new TokenService(
    new JwtService({ secret: 'x'.repeat(32), signOptions: { expiresIn: 900 } }),
  );

  it('signs a different access token every time, even within the same second', async () => {
    const first = await service.signAccessToken('user-1', 0);
    const second = await service.signAccessToken('user-1', 0);
    expect(second).not.toBe(first);
    await expect(service.verifyAccessToken(first)).resolves.toMatchObject({ sub: 'user-1', tv: 0 });
    await expect(service.verifyAccessToken(second)).resolves.toMatchObject({
      sub: 'user-1',
      tv: 0,
    });
  });

  it('refuses a token signed with another key', async () => {
    const other = new TokenService(new JwtService({ secret: 'y'.repeat(32) }));
    await expect(
      service.verifyAccessToken(await other.signAccessToken('user-1', 0)),
    ).resolves.toBeNull();
  });
});
