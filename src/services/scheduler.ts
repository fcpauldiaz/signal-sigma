import cron from 'node-cron';
import { SignalSigmaAuth } from './signalSigmaAuth';
import { SignalSigmaScraper } from './signalSigmaScraper';
import { SignalSigmaApi } from './signalSigmaApi';
import { TradierApi } from './tradierApi';
import { executeOpenOrders } from './openOrderExecutor';
import { notifyDeskJob, notifyOrders, notifyRebalance } from '../utils/deskNotify';
import { isExecutionEnabled } from '../utils/executionSettings';
import type { TradingMode } from '../utils/tradierConfig';

export class UnifiedScheduler {
  private rebalanceTask: cron.ScheduledTask | null = null;
  private orderTask: cron.ScheduledTask | null = null;
  private auth: SignalSigmaAuth;
  private portfolioId: string;
  private mode: TradingMode;
  private rebalanceSchedule: string;
  private orderSchedule: string;

  constructor(
    auth: SignalSigmaAuth,
    portfolioId: string,
    rebalanceSchedule: string,
    orderSchedule: string,
    mode: TradingMode = 'paper'
  ) {
    this.auth = auth;
    this.portfolioId = portfolioId;
    this.rebalanceSchedule = rebalanceSchedule;
    this.orderSchedule = orderSchedule;
    this.mode = mode;
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
          await notifyRebalance(this.mode, true);
        } else {
          console.error(
            `[Scheduled] Rebalancing failed: ${result.error || 'Unknown error'}`
          );
          await notifyRebalance(this.mode, false, result.error);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Scheduled] Rebalancing error:`, message);
        await notifyDeskJob({
          kind: 'rebalance',
          mode: this.mode,
          status: 'error',
          message,
        });
      }
    });

    this.orderTask = cron.schedule(this.orderSchedule, async () => {
      console.log(`\n[Scheduled] Starting order placement at ${new Date().toISOString()}`);
      try {
        if (!isExecutionEnabled(this.mode)) {
          console.log(
            `[Scheduled] Skipping order placement — ${this.mode} execution is disabled`
          );
          return;
        }
        await this.auth.ensureAuthenticated();
        const signalSigmaApi = new SignalSigmaApi(this.auth);
        const tradierApi = TradierApi.forMode(this.mode);

        const result = await executeOpenOrders({
          signalSigmaApi,
          tradierApi,
          portfolioId: this.portfolioId,
        });

        console.log(
          `[Scheduled] Done (${tradierApi.mode}). placed=${result.placedCount} skipped=${result.skippedCount} failed=${result.failedCount} confirmed=${result.confirmedCount}`
        );
        await notifyOrders(this.mode, result, { onlyIfActivity: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Scheduled] Order placement error:`, message);
        await notifyDeskJob({
          kind: 'place-orders',
          mode: this.mode,
          status: 'error',
          message,
        });
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
