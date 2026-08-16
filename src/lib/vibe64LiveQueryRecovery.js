function isVibe64LiveQuery(query = {}) {
  const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
  return queryKey[0] === "vibe64";
}

function invalidateVibe64LiveQueries(queryClient) {
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
