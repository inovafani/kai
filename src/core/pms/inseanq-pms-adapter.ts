import { RealPmsHttpAdapter, type RealPmsHttpAdapterConfig } from "./real-pms-http-adapter";

export class InseanqPmsAdapter extends RealPmsHttpAdapter {
  provider = "INSEANQ" as const;

  constructor(config: RealPmsHttpAdapterConfig = {}) {
    super(config);
  }
}
