import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type InflationSeries = Array<[bigint, number]>;
export interface CategoryRequest {
    region: string;
    category: string;
}
export interface backendInterface {
    getInflationData(request: CategoryRequest): Promise<InflationSeries>;
    getRegionalCategories(region: string): Promise<Array<string>>;
    getTopInflationSubcategories(region: string, n: bigint): Promise<Array<[string, number]>>;
}
