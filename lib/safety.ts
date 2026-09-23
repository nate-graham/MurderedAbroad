// Emergency detection for incoming chat messages.

const emergencyPattern =
  /\b(immediate danger|danger now|urgent danger|emergency|suicide|self[-\s]?harm|kill myself|end my life|threat|threatened|violence happening|being attacked|attack happening|unsafe now|right now)\b/i;

export function isEmergencyMessage(message: string): boolean {
  return emergencyPattern.test(message);
}
