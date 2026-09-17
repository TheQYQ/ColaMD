import mitt, { type Emitter } from 'mitt'

// NOTE: We intentionally use mitt's default (string → unknown) event map.
// mitt is strictly single-arg (`emit(type, event)`), so a tuple/unknown[]
// payload shape would require wrapping every existing emit call in an
// array, changing runtime semantics. As individual events are typed in
// later commits, we can swap to a tuple-aware wrapper.
const emitter: Emitter<Record<string, unknown>> = mitt()

export default emitter
