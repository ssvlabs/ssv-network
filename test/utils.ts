export const strToHex = str => `0x${Buffer.from(str, 'utf8').toString('hex')}`;

export const asciiToHex = str =>  {
  var arr1 = [];
  for (var n = 0, l = str.length; n < l; n ++)  {
    var hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
