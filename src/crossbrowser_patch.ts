if (!Math.log2) {
  Math.log2 = function (x: number): number {
    return Math.log(x) / Math.log(2);
  };
}
