import { TradierApi } from '../services/tradierApi';
import { PlaceableOrder } from '../types';

export type PlaceOrdersResult = {
  successful: PlaceableOrder[];
  failed: PlaceableOrder[];
};

export async function placeOrders(
  tradierApi: TradierApi,
  orders: PlaceableOrder[]
): Promise<PlaceOrdersResult> {
  const successful: PlaceableOrder[] = [];
  const failed: PlaceableOrder[] = [];

  for (const order of orders) {
    try {
      console.log(
        `Placing ${order.side} order for ${order.quantity} shares of ${order.symbol} (signal $${order.signalPrice})...`
      );

      const orderResponse = await tradierApi.placeOrder({
        class: 'equity',
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        type: 'market',
        duration: 'day',
        tag: `signal-sigma-${order.symbol}-${Date.now()}`,
      });

      if (orderResponse.order) {
        console.log(
          `  ✓ Order placed successfully. Order ID: ${orderResponse.order.id}, Status: ${orderResponse.order.status}`
        );
        successful.push(order);
      } else if (orderResponse.errors) {
        console.error(`  ✗ Order failed: ${JSON.stringify(orderResponse.errors)}`);
        failed.push(order);
      } else {
        console.error('  ✗ Order failed: empty Tradier response');
        failed.push(order);
      }
    } catch (error) {
      console.error(
        `  ✗ Failed to place order for ${order.symbol}:`,
        error instanceof Error ? error.message : error
      );
      failed.push(order);
    }
  }

  return { successful, failed };
}
