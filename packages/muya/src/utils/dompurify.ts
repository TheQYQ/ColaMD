import type { Config } from 'dompurify';
import DOMPurify from 'dompurify';

// Narrowed to the string-returning overload. DOMPurify's full overload set
// mentions TrustedHTML from `trusted-types`, a transitive dependency whose
// types cannot be named from this package, which breaks declaration emit
// (TS2883) for consumers of @muyajs/core.
type Sanitize = (dirty: string | Node, cfg?: Config) => string;

const purify = DOMPurify();
const sanitize: Sanitize = purify.sanitize;
const { isValidAttribute } = purify;

export { Config, isValidAttribute };

export default sanitize;
