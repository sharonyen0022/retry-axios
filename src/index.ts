import axios, {
	type AxiosError,
	type AxiosInstance,
	type AxiosRequestConfig,
	type AxiosResponse,
	isCancel,
} from 'axios';

/**
 * Configuration for the Axios `request` method.
 */
export interface RetryConfig {
	/**
	 * The number of times to retry the request.  Defaults to 3.
	 */
	retry?: number;

	/**
	 * The number of retries already attempted.
	 */
	currentRetryAttempt?: number;

	/**
	 * The number of retries remaining before giving up.
	 * Calculated as: retry - currentRetryAttempt
	 */
	retriesRemaining?: number;

	/**
	 * The delay in milliseconds used for retry backoff. Defaults to 100.
	 * - For 'static' backoff: Fixed delay between retries
	 * - For 'exponential' backoff: Base multiplier for exponential calculation
	 * - For 'linear' backoff: Ignored (uses attempt * 1000)
	 */
	retryDelay?: number;

	/**
	 * The HTTP Methods that will be automatically retried.
	 * Defaults to ['GET','PUT','HEAD','OPTIONS','DELETE']
	 */
	httpMethodsToRetry?: string[];

	/**
	 * The HTTP response status codes that will automatically be retried.
	 * Defaults to: [[100, 199], [429, 429], [500, 599]]
	 */
	statusCodesToRetry?: number[][];

	/**
	 * Function to invoke when error occurred.
	 */
	onError?: (error: AxiosError) => void | Promise<void>;

	/**
	 * Function to invoke when a retry attempt is made.
	 * The retry will wait for the returned promise to resolve before proceeding.
	 * If the promise rejects, the retry will be aborted and the rejection will be propagated.
	 */
	onRetryAttempt?: (error: AxiosError) => Promise<void>;

	/**
	 * Function to invoke which determines if you should retry.
	 * This is called after checking the retry count limit but before other default checks.
	 * Return true to retry, false to stop retrying.
	 * If not provided, uses the default retry logic based on status codes and HTTP methods.
	 */
	shouldRetry?: (error: AxiosError) => boolean;

	/**
	 * Backoff Type; 'linear', 'static' or 'exponential'.
	 */
	backoffType?: 'linear' | 'static' | 'exponential';

	/**
	 * Jitter strategy for exponential backoff. Defaults to 'none'.
	 * - 'none': No jitter (default)
	 * - 'full': Random delay between 0 and calculated exponential backoff
	 * - 'equal': Half fixed delay, half random
	 *
	 * Jitter helps prevent the "thundering herd" problem where many clients
	 * retry at the same time. Only applies when backoffType is 'exponential'.
	 */
	jitter?: 'none' | 'full' | 'equal';

	/**
	 * Whether to check for 'Retry-After' header in response and use value as delay. Defaults to true.
	 */
	checkRetryAfter?: boolean;

	/**
	 * Max permitted Retry-After value (in ms) - rejects if greater. Defaults to 5 mins.
	 */
	maxRetryAfter?: number;

	/**
	 * Ceiling for calculated delay (in ms) - delay will not exceed this value.
	 */
	maxRetryDelay?: number;

	/**
	 * Array of all errors encountered during retry attempts.
	 * Populated automatically when retries are performed.
	 * The first element is the initial error, subsequent elements are retry errors.
	 */
	returnFirstError?: boolean;

	errors?: AxiosError[];
}

export type RaxConfig = {
	raxConfig: RetryConfig;
} & AxiosRequestConfig;

// If this wasn't in the list of status codes where we want to automatically retry, return.
const retryRanges = [
	// https://en.wikipedia.org/wiki/List_of_HTTP_status_codes
	// 1xx - Retry (Informational, request still processing)
	// 2xx - Do not retry (Success)
	// 3xx - Do not retry (Redirect)
	// 4xx - Do not retry (Client errors)
	// 429 - Retry ("Too Many Requests")
	// 5xx - Retry (Server errors)
	[100, 199],
	[429, 429],
	[500, 599],
];

/**
 * Attach the interceptor to the Axios instance.
 * @param instance The optional Axios instance on which to attach the
 * interceptor.
 * @returns The id of the interceptor attached to the axios instance.
 */
export function attach(instance?: AxiosInstance) {
	const inst = instance || axios;
	return inst.interceptors.response.use(
		onFulfilled,
		async (error: AxiosError) => onError(inst, error),
	);
}

/**
 * Eject the Axios interceptor that is providing retry capabilities.
 * @param interceptorId The interceptorId provided in the config.
 * @param instance The axios instance using this interceptor.
 */
export function detach(interceptorId: number, instance?: AxiosInstance) {
	const inst = instance || axios;
	inst.interceptors.response.eject(interceptorId);
}

function onFulfilled(result: AxiosResponse) {
	return result;
}

/**
 * Some versions of axios are converting arrays into objects during retries.
 * This will attempt to convert an object with the following structure into
 * an array, where the keys correspond to the indices:
 * {
 *   0: {
 *     // some property
 *   },
 *   1: {
 *     // another
 *   }
 * }
 * @param obj The object that (may) have integers that correspond to an index
 * @returns An array with the pucked values
 */
function normalizeArray<T>(object?: T[]): T[] | undefined {
	const array: T[] = [];
	if (!object) {
		return undefined;
	}

	if (Array.isArray(object)) {
		return object;
	}

	if (typeof object === 'object') {
		for (const key of Object.keys(object)) {
			const number_ = Number.parseInt(key, 10);
			if (!Number.isNaN(number_)) {
				array[number_] = object[key];
			}
		}
	}

	return array;
}

function setConfigMetadata(config: RetryConfig, errors: AxiosError[]) {
	config.errors = errors;
	Object.defineProperty(config, 'toJSON', {
		value(this: RetryConfig) {
			const { errors: _errors, ...serializedConfig } = this;
			return serializedConfig;
		},
		writable: true,
		configurable: true,
		enumerable: false,
	});
}

/**
 * Parse the Retry-After header.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
 * @param header Retry-After header value
 * @returns Number of milliseconds, or undefined if invalid
 */
function parseRetryAfter(header: string): number | undefined {
	// Header value may be string containing integer seconds
	const value = Number(header);
	if (!Number.isNaN(value)) {
		return value * 1000;
	}

	// Or HTTP date time string
	const dateTime = Date.parse(header);
	if (!Number.isNaN(dateTime)) {
		return dateTime - Date.now();
	}

	return undefined;
}

async function onError(instance: AxiosInstance, error: AxiosError) {
  if (isCancel(error)) {
    throw error;
  }

  // --- Fix for Axios v1.1.3+ header loss: deep clone headers ---
const originalConfig = error.config;
if (originalConfig) {
  // Create a shallow copy
  const clonedConfig: any = { ...originalConfig };
  
  // Properly clone headers: use .clone() method if available, otherwise fallback
  if (originalConfig.headers) {
    if (typeof (originalConfig.headers as any).clone === 'function') {
      // AxiosHeaders has a clone method
      clonedConfig.headers = (originalConfig.headers as any).clone();
    } else {
      // Fallback for plain objects
      clonedConfig.headers = { ...originalConfig.headers };
    }
  }
  
  // Preserve raxConfig only if it exists (to avoid undefined assignment)
  if (originalConfig.raxConfig) {
    clonedConfig.raxConfig = originalConfig.raxConfig;
  }
  
  // Replace the original config with the cloned one
  error.config = clonedConfig;
}
// --- End of header fix ---

  const config = getConfig(error) || {};
  config.currentRetryAttempt ||= 0;
  config.retry = typeof config.retry === 'number' ? config.retry : 3;
  config.retryDelay =
    typeof config.retryDelay === 'number' ? config.retryDelay : 100;
  config.backoffType ||= 'exponential';
  config.httpMethodsToRetry = normalizeArray(config.httpMethodsToRetry) || [
    'GET',
    'HEAD',
    'PUT',
    'OPTIONS',
    'DELETE',
  ];
  config.checkRetryAfter =
    typeof config.checkRetryAfter === 'boolean' ? config.checkRetryAfter : true;
  config.maxRetryAfter =
    typeof config.maxRetryAfter === 'number'
      ? config.maxRetryAfter
      : 60_000 * 5;

  config.statusCodesToRetry =
    normalizeArray(config.statusCodesToRetry) || retryRanges;

  // Put the config back into the err
  const axiosError = error as AxiosError;

  // biome-ignore lint/suspicious/noExplicitAny: Allow for wider range of errors
  (axiosError.config as any) = axiosError.config || {};
  if (!(axiosError.config as RaxConfig).raxConfig) {
  (axiosError.config as RaxConfig).raxConfig = { ...config };
	}

  // Initialize errors array on first error, or append to existing array
  const errors = config.errors ?? [];
  errors.push(axiosError);

  setConfigMetadata(config, errors);
  setConfigMetadata((axiosError.config as RaxConfig).raxConfig, errors);

  // Determine if we should retry the request
  if (config.shouldRetry) {
    config.currentRetryAttempt ||= 0;
    if (config.currentRetryAttempt >= (config.retry ?? 0)) {
      throw getFinalError(config, axiosError);
    }
    if (!config.shouldRetry(axiosError)) {
      throw getFinalError(config, axiosError);
    }
  } else {
    if (!shouldRetryRequest(axiosError)) {
      throw getFinalError(config, axiosError);
    }
  }

  // Create a promise that invokes the retry after the backOffDelay
  const onBackoffPromise = new Promise((resolve, reject) => {
    let delay = 0;
    if (
      config.checkRetryAfter &&
      axiosError.response?.headers?.['retry-after']
    ) {
      const retryAfter = parseRetryAfter(
        axiosError.response.headers['retry-after'] as string,
      );
      if (
        retryAfter &&
        retryAfter > 0 &&
        retryAfter <= (config.maxRetryAfter ?? 0)
      ) {
        delay = retryAfter;
      } else {
        reject(getFinalError(config, axiosError));
        return;
      }
    }

    // Increment retry counter
    (axiosError.config as RaxConfig).raxConfig.currentRetryAttempt! += 1;

    // Calculate retries remaining
    (axiosError.config as RaxConfig).raxConfig.retriesRemaining =
      config.retry! -
      (axiosError.config as RaxConfig).raxConfig.currentRetryAttempt!;

    const retrycount = (axiosError.config as RaxConfig).raxConfig
      .currentRetryAttempt!;

    if (delay === 0) {
      if (config.backoffType === 'linear') {
        delay = retrycount * 1000;
      } else if (config.backoffType === 'static') {
        delay = config.retryDelay!;
      } else {
        const baseDelay = config.retryDelay!;
        delay = ((2 ** retrycount - 1) / 2) * baseDelay;

        const jitter = config.jitter || 'none';
        if (jitter === 'full') {
          delay = Math.random() * delay;
        } else if (jitter === 'equal') {
          delay = delay / 2 + Math.random() * (delay / 2);
        }
      }

      if (typeof config.maxRetryDelay === 'number') {
        delay = Math.min(delay, config.maxRetryDelay);
      }
    }

    setTimeout(resolve, delay);
  });

  if (config.onError) {
    await config.onError(axiosError);
  }

  return (
    Promise.resolve()
      .then(async () => onBackoffPromise)
      .then(async () => config.onRetryAttempt?.(axiosError))
      .then(async () => instance.request(axiosError.config!))
  );
}
/**
 * Determine based on config if we should retry the request.
 * @param err The AxiosError passed to the interceptor.
 */
export function shouldRetryRequest(error: AxiosError) {
	const config = (error.config as RaxConfig).raxConfig;

	// If there's no config, or retries are disabled, return.
	if (!config || config.retry === 0) {
		return false;
	}

	// Check if we are out of retry attempts first
	config.currentRetryAttempt ||= 0;
	if (config.currentRetryAttempt >= (config.retry ?? 0)) {
		return false;
	}

	// Only retry with configured HttpMethods.
	if (
		!error.config?.method ||
		!config.httpMethodsToRetry?.includes(error.config.method.toUpperCase())
	) {
		return false;
	}

	// For errors with responses, check status codes
	if (error.response?.status) {
		let isInRange = false;
		// biome-ignore lint/style/noNonNullAssertion: Checked above
		for (const [min, max] of config.statusCodesToRetry!) {
			const { status } = error.response;
			if (status >= min && status <= max) {
				isInRange = true;
				break;
			}
		}

		if (!isInRange) {
			return false;
		}
	}

	// For errors without responses (network errors, timeouts, etc.)
	// we allow retry as long as we haven't exceeded the retry limit
	// This includes: ETIMEDOUT, ENOTFOUND, ECONNABORTED, ECONNRESET, etc.

	return true;
}

/**
 * Acquire the raxConfig object from an AxiosError if available.
 * @param err The Axios error with a config object.
 */
export function getConfig(error: AxiosError) {
	if (error?.config) {
		return (error.config as RaxConfig).raxConfig;
	}
}

// Include this so `config.raxConfig` works easily.
// See https://github.com/JustinBeckwith/retry-axios/issues/64.
declare module 'axios' {
	export interface AxiosRequestConfig {
		raxConfig?: RetryConfig;
	}
}
function getFinalError(config: RetryConfig, currentError: AxiosError): AxiosError {
  if (config.returnFirstError && config.errors && config.errors.length > 0) {
    return config.errors[0];
  }
  return currentError;
}