import cron from 'node-cron';
import { SignalSigmaAuth } from './signalSigmaAuth';
import { SignalSigmaScraper } from './signalSigmaScraper';
import { SignalSigmaApi } from './signalSigmaApi';
import { TradierApi } from './tradierApi';
import { executeOpenOrders } from './openOrderExecutor';

export class UnifiedScheduler {
  private rebalanceTask: cron.ScheduledTask | null = null;
  private orderTask: cron.ScheduledTask | null = null;
  private auth: SignalSigmaAuth;
  private portfolioId: string;
  private tradierAccessToken: string;
  private tradierAccountId: string;
  private rebalanceSchedule: string;
  private orderSchedule: string;

  constructor(
    auth: SignalSigmaAuth,
    portfolioId: string,
    tradierAccessToken: string,
    tradierAccountId: string,
    rebalanceSchedule: string,
    orderSchedule: string
  ) {
    this.auth = auth;
    this.portfolioId = portfolioId;
    this.tradierAccessToken = tradierAccessToken;
    this.tradierAccountId = tradierAccountId;
    this.rebalanceSchedule = rebalanceSchedule;
    this.orderSchedule = orderSchedule;
  }

  start(): void {
    if (this.rebalanceTask || this.orderTask) {
      console.log('Scheduler is already running');
      return;
    }

    if (!cron.validate(this.rebalanceSchedule)) {
      throw new Error(`Invalid rebalancing cron schedule: ${this.rebalanceSchedule}`);
    }

    if (!cron.validate(this.orderSchedule)) {
      throw new Error(`Invalid order placement cron schedule: ${this.orderSchedule}`);
    }

    console.log(`Starting rebalancing scheduler with schedule: ${this.rebalanceSchedule}`);
    console.log(`Starting order placement scheduler with schedule: ${this.orderSchedule}`);

    this.rebalanceTask = cron.schedule(this.rebalanceSchedule, async () => {
      console.log(`\n[Scheduled] Starting rebalancing at ${new Date().toISOString()}`);
      try {
        await this.auth.ensureAuthenticated();
        const scraper = new SignalSigmaScraper(this.auth, this.portfolioId);
        const result = await scraper.triggerRebalancing();

        if (result.success) {
          console.log('[Scheduled] Rebalancing completed successfully');
        } else {
          console.error(
            `[Scheduled] Rebalancing failed: ${result.error || 'Unknown error'}`
          );
        }
      } catch (error) {
        console.error(
          `[Scheduled] Rebalancing error:`,
          error instanceof Error ? error.message : error
        );
      }
    });

    this.orderTask = cron.schedule(this.orderSchedule, async () => {
      console.log(`\n[Scheduled] Starting order placement at ${new Date().toISOString()}`);
      try {
        await this.auth.ensureAuthenticated();
        const signalSigmaApi = new SignalSigmaApi(this.auth);
        const tradierApi = new TradierApi(
          this.tradierAccessToken,
          this.tradierAccountId
        );

        const result = await executeOpenOrders({
          signalSigmaApi,
          tradierApi,
          portfolioId: this.portfolioId,
        });

        console.log(
          `[Scheduled] Done. placed=${result.placedCount} skipped=${result.skippedCount} failed=${result.failedCount} confirmed=${result.confirmedCount}`
        );
      } catch (error) {
        console.error(
          `[Scheduled] Order placement error:`,
          error instanceof Error ? error.message : error
        );
      }
    });

    console.log('Scheduler started successfully');
  }

  stop(): void {
    if (this.rebalanceTask) {
      this.rebalanceTask.stop();
      this.rebalanceTask = null;
    }
    if (this.orderTask) {
      this.orderTask.stop();
      this.orderTask = null;
    }
    console.log('Scheduler stopped');
  }

  isRunning(): boolean {
    return this.rebalanceTask !== null || this.orderTask !== null;
  }
}
