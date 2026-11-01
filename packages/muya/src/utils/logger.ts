type TLevel = 'error' | 'warn' | 'log' | 'info';

const levels: TLevel[] = ['error', 'warn', 'log', 'info'];
let level: TLevel = 'log';

type Ilogger = Record<TLevel, (...args: string[]) => void> & {
    level: (newLevel: TLevel) => void;
    /**
     * Same predicate debug() applies — lets hot call sites skip building
     * expensive arguments (e.g. JSON.stringify of an operation) entirely.
     */
    isEnabled: (method: TLevel) => boolean;
};

function isEnabled(method: TLevel): boolean {
    return (
        levels.indexOf(method) <= levels.indexOf(level)
        // eslint-disable-next-line node/prefer-global/process
        && process.env.NODE_ENV !== 'production'
    );
}

function debug(method: TLevel, ...args: unknown[]) {
    if (isEnabled(method)) {
        // eslint-disable-next-line no-console
        console[method](...args);
    }
}

function namespace(ns: string): Ilogger {
    const logger = levels.reduce((logger, method) => {
        logger[method] = debug.bind(console, method, ns);

        return logger;
    }, {} as Ilogger);
    logger.isEnabled = isEnabled;

    return logger;
}

namespace.level = (newLevel: TLevel) => {
    level = newLevel;
};
debug.level = namespace.level;

export default namespace;
