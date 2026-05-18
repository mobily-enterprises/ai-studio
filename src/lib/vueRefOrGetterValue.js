import { unref } from "vue";

function readRefOrGetterValue(value) {
  return typeof value === "function" ? value() : unref(value);
}

function readRefOrGetterBoolean(value) {
  return Boolean(readRefOrGetterValue(value));
}

export {
  readRefOrGetterBoolean,
  readRefOrGetterValue
};
