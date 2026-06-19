import { UnsupportedRealPmsAdapter } from "./unsupported-real-pms-adapter";

export class RezdyPmsAdapter extends UnsupportedRealPmsAdapter {
  provider = "REZDY" as const;
}
