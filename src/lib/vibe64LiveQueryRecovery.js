function isVibe64LiveQuery(query = {}) {
  const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
  return queryKey[0] === "vibe64";
}

function invalidateVibe64LiveQueries(app) {
  if (
    !app ||
    typeof app.has !== "function" ||
    typeof app.make !== "function" ||
    !app.has("jskit.client.query-client")
  ) {
    return null;
  }

  const queryClient = app.make("jskit.client.query-client");
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    return null;
  }

  return queryClient.invalidateQueries({
    predicate: isVibe64LiveQuery,
    refetchType: "active"
  });
}

export {
  invalidateVibe64LiveQueries,
  isVibe64LiveQuery
};
