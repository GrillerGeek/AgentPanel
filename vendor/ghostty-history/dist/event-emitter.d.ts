import type { IEvent } from './interfaces';
export declare class EventEmitter<T> {
    private listeners;
    fire(arg: T): void;
    event: IEvent<T>;
    dispose(): void;
}
