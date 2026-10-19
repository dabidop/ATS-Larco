import { Controller, Module, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      module: 'api',
      timestamp: new Date().toISOString(),
    } as const;
  }
}

@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
