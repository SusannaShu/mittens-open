let _payload: any = null;

export const setResultsPayload = (data: any) => {
  _payload = data;
};

export const getResultsPayload = () => {
  const data = _payload;
  _payload = null; // Consume once
  return data;
};
