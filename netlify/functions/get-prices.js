const handler = async function(event, context) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ test: "ok", version: 2 })
  };
};
module.exports = { handler };
